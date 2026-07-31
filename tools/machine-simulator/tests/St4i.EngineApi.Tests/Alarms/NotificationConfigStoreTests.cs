using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// Task C-2 — unit proof of <see cref="NotificationConfigStore"/>: the migration ladder, per-channel
/// round-trips, the never-throws contract, DPAPI secret handling, the directory ACL, and — the reason this
/// task exists — that a credential cannot reach a public read, a returned object, a log line, or a copy of
/// the database file.
/// </summary>
public sealed class NotificationConfigStoreTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-notificationconfig-tests-").FullName;

    /// <summary>A value distinctive enough that finding it ANYWHERE is proof of a leak.</summary>
    private const string SecretSentinel = "S3CRET-do-not-leak-2b3f9a17";

    /// <summary>Shaped like a real Slack incoming webhook: the capability lives entirely in the path.</summary>
    private const string WebhookUrlWithSecretPath =
        "https://hooks.slack.example/services/T000/B000/" + SecretSentinel;

    // ─────────────────────────────────────────────────────────────────────
    // 1. Migration ladder — applies from empty, and is idempotent across repeated opens.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Migrations_ApplyFromEmpty_CreatingEveryTableAndStampingUserVersion()
    {
        var store = new NotificationConfigStore(TempDir());

        using var connection = Open(store);
        // v1 = C-2's five tables; v2 = C-3's webhook auth_header_name append; v3 = C-6's relay on/off values.
        Assert.Equal(3L, UserVersion(connection));

        // Five tables, discovered rather than asserted by name — the same source of truth the structural
        // test below uses.
        var tables = DiscoverTables(connection);
        Assert.Equal(5, tables.Count);
        Assert.Contains(NotificationConfigSchema.ChannelsTable, tables);
        Assert.Contains(NotificationConfigSchema.SecretsTable, tables);
    }

    /// <summary>Re-opening the same directory must not re-run the ladder, must not throw, and must not
    /// disturb the data — the ordinary case every process restart exercises.</summary>
    [Fact]
    public async Task Migrations_AreIdempotentAcrossRepeatedOpens_AndPreserveData()
    {
        var dir = TempDir();

        var first = new NotificationConfigStore(dir);
        Assert.True(await first.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, "MODBUS-01", RelayTargetKind.Command, "AnnunciatorOn"));

        for (var open = 0; open < 3; open++)
        {
            var reopened = new NotificationConfigStore(dir);

            using (var connection = Open(reopened))
            {
                Assert.Equal(3L, UserVersion(connection));
            }

            var relay = await reopened.GetRelayAsync();
            Assert.NotNull(relay);
            Assert.Equal("MODBUS-01", relay!.MachineCode);
            Assert.Equal(RelayTargetKind.Command, relay.TargetKind);
            Assert.Equal("AnnunciatorOn", relay.TargetName);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. 🔴 The structural guarantee — the test that must catch TOMORROW's mistake.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The central safety test. It does not check today's field list; it checks four things against
    /// each other so a FUTURE column — or a future TABLE — cannot slip through:
    /// <list type="number">
    /// <item><description><b>The table list is discovered from <c>sqlite_master</c>, not named here.</b>
    /// Review round 1 (I1): when the test enumerated five hard-coded tables, a maintainer adding a sixth
    /// (C-3's <c>webhook_headers</c>, a future <c>teams_config</c>) got a green suite no matter what was in
    /// it. Discovery closes that.</description></item>
    /// <item><description><b>The classification is exhaustive</b>, in both directions, against every column
    /// of every discovered table. A maintainer who adds <c>webhook_bearer_token</c> and says nothing about
    /// it fails here — they are forced to declare whether it is a secret.</description></item>
    /// <item><description><b>No public projection names a secret-bearing column.</b> Having declared their
    /// new column a secret, adding it to a summary constant fails here.</description></item>
    /// <item><description><b>Every <c>*SummaryColumns</c> constant is registered in
    /// <c>PublicProjections</c></b>, by reflection. Also I1: a second summary constant that nobody
    /// registered would simply never have been scanned by (3).</description></item>
    /// </list>
    /// Plus a non-vacuity anchor, because (3) would pass trivially if the secret classifications were
    /// deleted. The projection strings compared here are the very constants
    /// <see cref="NotificationConfigStore"/> builds its SQL from, not copies.
    /// </summary>
    [Fact]
    public void TheSchemaIsFullyClassified_AndNoPublicProjectionSelectsASecretBearingColumn()
    {
        var store = new NotificationConfigStore(TempDir());
        using var connection = Open(store);

        // (1) + (2) — discovered tables, exhaustively classified.
        var physical = new HashSet<(string Table, string Column)>();
        foreach (var table in DiscoverTables(connection))
        {
            using var cmd = connection.CreateCommand();
            // `table` comes from sqlite_master in this same database, never from user input.
            cmd.CommandText = $"PRAGMA table_info({table});";
            using var reader = cmd.ExecuteReader();
            while (reader.Read()) physical.Add((table, reader.GetString(reader.GetOrdinal("name"))));
        }

        var classified = NotificationConfigSchema.Classification
            .Select(entry => (entry.Table, entry.Column))
            .ToHashSet();

        var unclassified = physical.Except(classified).OrderBy(c => c.Table).ThenBy(c => c.Column).ToList();
        Assert.True(unclassified.Count == 0,
            "These columns physically exist but are not classified in NotificationConfigSchema.Classification. " +
            "Declare whether each one is secret-bearing before it can reach a read projection: " +
            string.Join(", ", unclassified.Select(c => $"{c.Table}.{c.Column}")));

        var stale = classified.Except(physical).OrderBy(c => c.Table).ThenBy(c => c.Column).ToList();
        Assert.True(stale.Count == 0,
            "These columns are classified but no longer exist — the classification has drifted from the schema: " +
            string.Join(", ", stale.Select(c => $"{c.Table}.{c.Column}")));

        // (3) No public projection may name a secret-bearing column.
        var secretBearing = NotificationConfigSchema.Classification
            .Where(entry => entry.SecretBearing)
            .Select(entry => (entry.Table, entry.Column))
            .ToHashSet();

        foreach (var (table, columns) in NotificationConfigSchema.PublicProjections)
        {
            foreach (var column in NotificationConfigSchema.Split(columns))
            {
                Assert.False(secretBearing.Contains((table, column)),
                    $"The public projection for '{table}' selects '{column}', which is classified as " +
                    "secret-bearing. A credential must never be in the SQL a public read runs — remove it " +
                    "from the SUMMARY constant (it belongs only in the FULL one).");
            }
        }

        // (4) Every *SummaryColumns projection is actually registered, so none escapes the scan in (3).
        //
        // Review round 2 (M3): `static readonly string` counts as well as `const`, so declaring a
        // projection the other way does not silently skip it. (M2): matching by VALUE alone let a new
        // constant that happened to duplicate an existing string slip through, and let one be registered
        // against the WRONG table — so the count is pinned as well, and every projected column is required
        // to actually exist on the table it is registered against, which is what a wrong-table
        // registration violates.
        var summaryProjections = typeof(NotificationConfigSchema)
            .GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
            .Where(field => (field.IsLiteral || field.IsInitOnly) && field.FieldType == typeof(string) &&
                            field.Name.EndsWith("SummaryColumns", StringComparison.Ordinal))
            .Select(field => (
                field.Name,
                Value: (string)(field.IsLiteral ? field.GetRawConstantValue()! : field.GetValue(null)!)))
            .ToList();

        Assert.NotEmpty(summaryProjections);

        Assert.True(NotificationConfigSchema.PublicProjections.Length == summaryProjections.Count,
            $"NotificationConfigSchema declares {summaryProjections.Count} *SummaryColumns projection(s) " +
            $"({string.Join(", ", summaryProjections.Select(p => p.Name))}) but PublicProjections registers " +
            $"{NotificationConfigSchema.PublicProjections.Length}. Every summary projection must be " +
            "registered exactly once, or nothing checks it for secret-bearing columns.");

        var registered = NotificationConfigSchema.PublicProjections
            .Select(projection => projection.Columns)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var (name, value) in summaryProjections)
        {
            Assert.True(registered.Contains(value),
                $"NotificationConfigSchema.{name} is a public summary projection but is not registered in " +
                "PublicProjections, so nothing checks it for secret-bearing columns.");
        }

        // Registered against the RIGHT table: every projected column must exist on it. This is what a
        // copy-paste registration — (SmtpTable, WebhookSummaryColumns) — actually gets wrong, and it would
        // otherwise sail past (3), since the columns are simply absent from that table's classification.
        foreach (var (table, columns) in NotificationConfigSchema.PublicProjections)
        {
            foreach (var column in NotificationConfigSchema.Split(columns))
            {
                Assert.True(physical.Contains((table, column)),
                    $"The public projection registered for '{table}' names column '{column}', which does " +
                    $"not exist on '{table}'. It is registered against the wrong table.");
            }
        }

        // Non-vacuity — (3) must not be passing because nothing is classified secret any more. Since
        // review round 1 (I2) moved the webhook URL into notification_secrets, there is exactly ONE
        // secret-bearing column in the whole schema, and every credential in the product lives in it.
        var onlySecret = Assert.Single(secretBearing);
        Assert.Equal((NotificationConfigSchema.SecretsTable, "secret"), onlySecret);

        // ...and it remains reachable through its own FULL projection, so the split is a split rather than
        // the column having quietly become unreadable everywhere.
        Assert.Contains("secret", NotificationConfigSchema.Split(NotificationConfigSchema.SecretFullColumns));
        Assert.DoesNotContain("secret", NotificationConfigSchema.Split(NotificationConfigSchema.SecretSummaryColumns));
    }

    /// <summary>
    /// The black-box companion: whatever the column analysis says, the object a public read returns must
    /// not contain any credential. Serialising the WHOLE result and searching it catches a leak the schema
    /// analysis cannot model — e.g. somebody adding a computed property that returns the URL, which is not
    /// a column at all.
    /// </summary>
    [Fact]
    public async Task ListAsync_NeverCarriesTheWebhookUrlOrAnySecret_EvenSerialisedWhole()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath, label: "Ops Slack"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "mail.local", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, "svc-account"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        var summaries = await store.ListAsync();
        var serialised = JsonSerializer.Serialize(summaries);

        Assert.DoesNotContain(SecretSentinel, serialised, StringComparison.Ordinal);
        Assert.DoesNotContain(WebhookUrlWithSecretPath, serialised, StringComparison.Ordinal);

        // Non-vacuity: the read really did return the channels (so "no sentinel" is not "no data"), and it
        // reports that each credential EXISTS, plus the non-secret facts an operator needs, without values.
        var webhook = Assert.Single(summaries, s => s.Channel == NotificationChannel.Webhook);
        Assert.NotNull(webhook.Webhook);
        Assert.True(webhook.Webhook!.HasUrl);
        Assert.True(webhook.Webhook.HasSigningSecret);
        Assert.Equal("https://hooks.slack.example", webhook.Webhook.Endpoint);
        Assert.Equal("Ops Slack", webhook.Webhook.Label);
        Assert.NotEmpty(webhook.Webhook.UrlFingerprint);

        var smtp = Assert.Single(summaries, s => s.Channel == NotificationChannel.Smtp);
        Assert.True(smtp.Smtp!.HasPassword);
        Assert.Equal("svc-account", smtp.Smtp.Username);
    }

    /// <summary>The engine-internal read DOES return the URL — otherwise C-3 could never post anything,
    /// and the encryption would be hiding the value from everyone rather than from the public read.</summary>
    [Fact]
    public async Task GetWebhookAsync_DoesReturnTheDecryptedUrl_ForTheEngineInternalCaller()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        var config = await store.GetWebhookAsync();

        Assert.NotNull(config);
        Assert.Equal(WebhookUrlWithSecretPath, config!.Url);
        Assert.Equal("https://hooks.slack.example", config.Endpoint);
        Assert.Equal(NotificationConfigStore.DefaultInstance, config.Instance);
    }

    /// <summary>🔴 Review round 1 (I2) — the URL is a DPAPI blob, so a COPIED database is inert. This is
    /// the exposure an ACL cannot cover and the reason the URL is no longer a plaintext column.</summary>
    [Fact]
    public async Task TheWebhookUrl_IsNotOnDiskInClearText_SoACopiedDatabaseGrantsNothing()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        AssertNotOnDisk(store, SecretSentinel);

        // Non-vacuity: the derived, deliberately NON-secret display value IS on disk in the clear, so the
        // assertion above is about encryption rather than about the file being empty.
        Assert.Contains("hooks.slack.example", ReadAllDbBytesAsText(store), StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. 🔴 Review round 1 (I3) — the URL's absence has to remain OPERABLE.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <see cref="WebhookChannelSummary.Endpoint"/> is <c>https://hooks.slack.example</c> for every
    /// Slack webhook that ever existed, so it cannot answer "did somebody change where this points?". The
    /// fingerprint can, without ever returning the capability — which is what stops C-7/C-8 from being
    /// pushed into exposing the URL to build a usable configuration screen.
    /// </summary>
    [Fact]
    public async Task TwoDifferentUrlsOnTheSameHost_ShareAnEndpointButDifferInFingerprint()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://hooks.slack.example/services/T0/B0/AAAA"));
        var first = Assert.Single(await store.ListAsync()).Webhook!;

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://hooks.slack.example/services/T0/B0/BBBB"));
        var second = Assert.Single(await store.ListAsync()).Webhook!;

        Assert.Equal(first.Endpoint, second.Endpoint);                 // indistinguishable...
        Assert.NotEqual(first.UrlFingerprint, second.UrlFingerprint);  // ...until the fingerprint

        // Stable: re-saving the SAME url reproduces the SAME fingerprint, so "unchanged" is provable too.
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://hooks.slack.example/services/T0/B0/AAAA"));
        Assert.Equal(first.UrlFingerprint, Assert.Single(await store.ListAsync()).Webhook!.UrlFingerprint);
    }

    /// <summary>The fingerprint must not become a way to read the URL back — it is a comparison token, so
    /// it must not contain the material it fingerprints.</summary>
    [Fact]
    public async Task TheFingerprint_IsAnOpaqueDigest_NotAnEncodingOfTheUrl()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        var fingerprint = Assert.Single(await store.ListAsync()).Webhook!.UrlFingerprint;

        Assert.DoesNotContain(SecretSentinel, fingerprint, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(16, fingerprint.Length);
        Assert.All(fingerprint, c => Assert.Contains(c, "0123456789ABCDEF"));
    }

    [Fact]
    public async Task TheOperatorLabel_RoundTripsAndIsVisibleInThePublicRead_ButIsOptional()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/hook", label: "MES line 3"));
        Assert.Equal("MES line 3", Assert.Single(await store.ListAsync()).Webhook!.Label);
        Assert.Equal("MES line 3", (await store.GetWebhookAsync())!.Label);

        // Optional — re-saving without one clears it rather than silently keeping a stale name.
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.Null(Assert.Single(await store.ListAsync()).Webhook!.Label);

        // Bounded.
        Assert.False(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/hook",
            label: new string('x', NotificationConfigStore.MaxLabelLength + 1)));
    }

    [Theory]
    [InlineData("https://host.example/a/b?token=x", "https://host.example")]
    [InlineData("http://10.0.0.5:8080/hook", "http://10.0.0.5:8080")]
    [InlineData("https://host.example:443/hook", "https://host.example")]
    // Review round 1 (M2) — userinfo is excluded by Uri.Host, not by anything this code does, so it is
    // worth pinning: a credential smuggled into user:pass@ must not survive into the display value.
    [InlineData("https://user:pass@host.example/hook", "https://host.example")]
    public async Task TheDerivedEndpoint_KeepsSchemeHostAndPort_AndDiscardsEverythingThatCanCarryAToken(
        string url, string expectedEndpoint)
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, url));

        var summary = Assert.Single(await store.ListAsync());
        Assert.Equal(expectedEndpoint, summary.Webhook!.Endpoint);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-url")]
    [InlineData("/relative/only")]
    [InlineData("ftp://host.example/hook")]
    public async Task SaveWebhookAsync_RefusesAnythingThatIsNotAnAbsoluteHttpUrl(string url)
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, url));
        Assert.Empty(await store.ListAsync()); // and the channel row was rolled back with it
        Assert.Null(await store.GetSecretAsync(NotificationChannel.Webhook, NotificationSecretNames.WebhookUrl));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Round-trips — every channel's facts survive.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EveryChannel_RoundTripsAllOfItsFacts()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.Critical, "https://mes.plant/alarm?src=sim", label: "MES"));
        Assert.True(await store.SaveSmtpAsync(
            enabled: false, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant", "maint@plant" }, "svc-account"));
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        Assert.True(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, "MODBUS-01", RelayTargetKind.Point, "annunciator",
            // 🔴 Task C-6 (schema v3) — a POINT target requires both latch values; see RelayChannelConfig.
            onValueJson: "1", offValueJson: "0"));

        // A fresh instance over the same directory — restart survival, the same technique
        // ConnectorConfigStoreTests uses.
        var reopened = new NotificationConfigStore(dir);

        var webhook = await reopened.GetWebhookAsync();
        Assert.True(webhook!.Enabled);
        Assert.Equal(AlarmPriority.Critical, webhook.MinPriority);
        Assert.Equal("https://mes.plant/alarm?src=sim", webhook.Url);
        Assert.Equal("MES", webhook.Label);

        var smtp = await reopened.GetSmtpAsync();
        Assert.False(smtp!.Enabled);
        Assert.Equal(AlarmPriority.High, smtp.MinPriority);
        Assert.Equal("smtp.plant", smtp.Host);
        Assert.Equal(587, smtp.Port);
        Assert.Equal(SmtpTlsMode.StartTls, smtp.Tls);
        Assert.Equal("sim@plant", smtp.FromAddress);
        Assert.Equal(new[] { "ops@plant", "maint@plant" }, smtp.Recipients);
        Assert.Equal("svc-account", smtp.Username);

        var local = await reopened.GetLocalAnnunciationAsync();
        Assert.True(local!.Enabled);
        Assert.Equal(AlarmPriority.High, local.MinPriority);

        var relay = await reopened.GetRelayAsync();
        Assert.True(relay!.Enabled);
        Assert.Equal("MODBUS-01", relay.MachineCode);
        Assert.Equal(RelayTargetKind.Point, relay.TargetKind);
        Assert.Equal("annunciator", relay.TargetName);

        Assert.Equal(4, (await reopened.ListAsync()).Count);
    }

    [Fact]
    public async Task SavingTheSameChannelTwice_Upserts_AndPreservesWhenItWasFirstConfigured()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        var first = Assert.Single(await store.ListAsync());
        await Task.Delay(15);
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.Critical));

        var second = Assert.Single(await store.ListAsync()); // still ONE row, not two
        Assert.False(second.Enabled);
        Assert.Equal(AlarmPriority.Critical, second.MinPriority);
        Assert.True(second.UpdatedAtUtc >= first.UpdatedAtUtc);
    }

    /// <summary>
    /// 🔴 Review round 1 (I4) — <c>instance</c> is in the primary key from v1, so a second webhook is a new
    /// ROW. Nothing in this build writes a non-default instance, which is exactly why this is worth
    /// pinning now: the alternative was discovering after field data existed that supporting Slack AND the
    /// MES meant rebuilding three tables and re-keying every stored DPAPI blob (a second webhook's
    /// <c>webhook.signing_secret</c> would have collided with the first's).
    /// </summary>
    [Fact]
    public async Task TwoInstancesOfOneChannel_CoexistWithIndependentConfigurationAndSecrets()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://hooks.slack.example/services/AAA", label: "Slack"));
        Assert.True(await store.SaveWebhookAsync(
            enabled: false, AlarmPriority.Critical, "https://mes.plant/alarm", label: "MES",
            instance: "mes"));

        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, "key-default"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, "key-mes",
            instance: "mes"));

        var all = await store.ListAsync();
        Assert.Equal(2, all.Count);
        Assert.All(all, s => Assert.Equal(NotificationChannel.Webhook, s.Channel));

        var slack = await store.GetWebhookAsync();
        var mes = await store.GetWebhookAsync("mes");
        Assert.Equal("https://hooks.slack.example/services/AAA", slack!.Url);
        Assert.Equal("https://mes.plant/alarm", mes!.Url);
        Assert.True(slack.Enabled);
        Assert.False(mes.Enabled);

        // The secrets did not collide.
        Assert.Equal("key-default", await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        Assert.Equal("key-mes", await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, instance: "mes"));

        // Deleting one instance leaves the other entirely intact.
        Assert.True(await store.DeleteAsync(NotificationChannel.Webhook, instance: "mes"));
        Assert.Single(await store.ListAsync());
        Assert.Null(await store.GetWebhookAsync("mes"));
        Assert.NotNull(await store.GetWebhookAsync());
        Assert.Equal("key-default", await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheChannelItsConfigurationAndEverySecret_Together()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        Assert.True(await store.DeleteAsync(NotificationChannel.Webhook));

        Assert.Empty(await store.ListAsync());
        Assert.Null(await store.GetWebhookAsync());
        // 🔴 ON DELETE CASCADE takes BOTH stored secrets — the signing key and the URL itself — so no
        // orphaned credential is left behind for a channel nobody configured.
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookUrl));
        Assert.False(await store.DeleteAsync(NotificationChannel.Webhook)); // already gone
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Secrets — round-trip, corrupt blob, and the foreign-key ordering rule.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ASecret_SurvivesAStoreRoundTrip_AndIsNotStoredInClearText()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, "svc"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        var reopened = new NotificationConfigStore(dir);
        Assert.Equal(SecretSentinel, await reopened.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));

        AssertNotOnDisk(store, SecretSentinel);
    }

    /// <summary>A corrupt or foreign blob reads as "no stored secret" and does NOT throw — the same rule
    /// <c>CredentialStore.Load</c> follows, and load-bearing here because this read happens on the
    /// notification dispatch path.</summary>
    [Fact]
    public async Task ACorruptOrForeignSecretBlob_ReadsAsAbsent_AndDoesNotThrow()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, null));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        // Valid DPAPI-LocalMachine ciphertext, but under DIFFERENT entropy — i.e. a blob from somewhere
        // else, which Unprotect rejects exactly like plain corruption.
        var foreign = ProtectedData.Protect(
            System.Text.Encoding.UTF8.GetBytes("should-never-come-back"),
            System.Text.Encoding.UTF8.GetBytes("some-other-entropy"),
            DataProtectionScope.LocalMachine);

        using (var connection = Open(store))
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText =
                "UPDATE notification_secrets SET secret = @secret WHERE channel = 'Smtp' AND name = @name;";
            cmd.Parameters.AddWithValue("@secret", foreign);
            cmd.Parameters.AddWithValue("@name", NotificationSecretNames.SmtpPassword);
            Assert.Equal(1, cmd.ExecuteNonQuery());
        }
        SqliteConnection.ClearAllPools();

        Exception? captured = null;
        var reopened = new NotificationConfigStore(dir, logError: (ex, _) => captured = ex);

        Assert.Null(await reopened.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));

        // A corrupt blob is NOT an error path — it is a normal "no stored secret" answer, so nothing is
        // logged either. (Contrast the never-throws tests below, which DO capture an exception.)
        Assert.Null(captured);
    }

    /// <summary>An unreadable URL blob leaves a webhook that is configured but cannot post — and the
    /// public read says so, rather than the channel looking healthy.</summary>
    [Fact]
    public async Task AWebhookWhoseUrlBlobIsMissing_ReportsHasUrlFalse_AndYieldsANullUrl()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        using (var connection = Open(store))
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "DELETE FROM notification_secrets WHERE name = @name;";
            cmd.Parameters.AddWithValue("@name", NotificationSecretNames.WebhookUrl);
            Assert.Equal(1, cmd.ExecuteNonQuery());
        }
        SqliteConnection.ClearAllPools();

        var reopened = new NotificationConfigStore(dir);
        Assert.Null((await reopened.GetWebhookAsync())!.Url);
        Assert.False(Assert.Single(await reopened.ListAsync()).Webhook!.HasUrl);
    }

    [Fact]
    public async Task ASecretForAChannelThatWasNeverConfigured_IsRefused_LeavingNoOrphanedCredential()
    {
        var store = new NotificationConfigStore(TempDir());

        // No SaveSmtpAsync first — the foreign key has nothing to point at.
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));
    }

    [Fact]
    public async Task DeleteSecretAsync_RemovesOnlyThatSecret_AndLeavesTheChannelConfigured()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        Assert.True(await store.DeleteSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        var summary = Assert.Single(await store.ListAsync());
        Assert.False(summary.Webhook!.HasSigningSecret);
        Assert.True(summary.Webhook.HasUrl); // the URL secret is untouched
        Assert.Equal("https://mes.plant", summary.Webhook.Endpoint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. 🔴 No secret in any log line this store emits, including error paths.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every failure this store can report goes through one <c>logError</c> callback. This drives the
    /// reachable failure paths that HANDLE a secret and asserts the sentinel appears neither in the
    /// message nor anywhere in the exception (whose <c>ToString</c> includes its message, inner exceptions
    /// and stack) — the place a parameter value would surface if one were ever interpolated in.
    /// </summary>
    [Fact]
    public async Task NoSecretEverReachesALogLine_OnAnyReachableFailurePath()
    {
        var dir = TempDir();
        var logged = new List<string>();
        var store = new NotificationConfigStore(dir, logError: (ex, message) =>
        {
            logged.Add(message);
            logged.Add(ex.ToString());
        });

        // (a) Storing a secret for a channel that does not exist — a foreign-key failure raised while the
        //     plaintext is in scope, which is the most likely place for it to be interpolated into a
        //     message by accident.
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        // (b) A webhook URL that fails validation while the (capability-bearing) URL is in scope.
        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "not-a-url-" + SecretSentinel));

        // (c) Reading and writing against a directory that has vanished, with the plaintext in hand.
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);
        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookUrl));
        Assert.Empty(await store.ListAsync());

        // Non-vacuity: these paths really did report failures, so "no sentinel" is not "no log lines".
        Assert.NotEmpty(logged);

        foreach (var line in logged)
        {
            Assert.DoesNotContain(SecretSentinel, line, StringComparison.Ordinal);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Never-throws — mirroring AlarmStore's own directory-is-gone tests.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Every member must survive its directory vanishing underneath it, because this store is
    /// read from the notification dispatch path that sits behind <c>AlarmStore</c>'s never-throws
    /// contract. Mirrors <c>AlarmStoreTests.RaiseAsync_NeverThrows_WhenTheDbDirectoryIsGone</c>.</summary>
    [Fact]
    public async Task EveryMember_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = TempDir();
        var errors = new List<string>();
        var store = new NotificationConfigStore(dir, logError: (_, message) => errors.Add(message));

        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));

        // The ctor already opened (and Microsoft.Data.Sqlite pools) a native connection against this file.
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // None of these may throw — an unhandled exception fails this test on its own.
        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.False(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, null));
        Assert.False(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        // 🔴 Task C-6 — a COMMAND target deliberately, so this row's falseness can ONLY come from the
        // broken store. A Point target without latch values is now refused by validation, which would have
        // made this assertion pass vacuously against a perfectly healthy store.
        Assert.False(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.High, "M-1", RelayTargetKind.Command, "annunciator"));
        Assert.False(await store.DeleteAsync(NotificationChannel.Webhook));
        Assert.False(await store.SetSecretAsync(NotificationChannel.Webhook, "n", "v"));
        Assert.Null(await store.GetSecretAsync(NotificationChannel.Webhook, "n"));
        Assert.False(await store.DeleteSecretAsync(NotificationChannel.Webhook, "n"));
        Assert.Null(await store.GetWebhookAsync());
        Assert.Null(await store.GetSmtpAsync());
        Assert.Null(await store.GetLocalAnnunciationAsync());
        Assert.Null(await store.GetRelayAsync());
        Assert.Empty(await store.ListAsync());

        Assert.NotEmpty(errors); // the failures were reported, not silently swallowed
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. The directory ACL — the boundary against another local account.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Mirrors <c>CredentialStoreTests.Save_locks_down_creds_directory_acl</c>. Asserted after a
    /// SAVE rather than only after construction, because the ACL is re-applied on every secret write —
    /// self-healing for an install upgraded from a build that predates this store.</summary>
    [Fact]
    public async Task SetSecretAsync_LocksDownTheNotificationsDirectoryAcl()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        var acl = new DirectoryInfo(dir).GetAccessControl(AccessControlSections.Access);

        // Inheritance disabled — %ProgramData%'s default Authenticated-Users grant no longer applies.
        Assert.True(acl.AreAccessRulesProtected);

        var grantedTo = acl
            .GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>()
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToArray();

        Assert.Contains(grantedTo, sid => sid.Equals(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null)));
        Assert.Contains(grantedTo, sid => sid.Equals(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)));
    }

    /// <summary>
    /// 🔴 Review round 2 (F1) — the regression this pins. <see cref="NotificationConfigStore.SaveWebhookAsync"/>
    /// writes credential material (the URL) through its own transaction, and round 1 introduced it calling
    /// straight into the secret upsert — bypassing the ACL, which was then applied only by
    /// <see cref="NotificationConfigStore.SetSecretAsync"/>. So the newest credential path was the one path
    /// that skipped the lock-down.
    ///
    /// <para>The constructor also applies the ACL, which would mask the gap entirely — so this test first
    /// UNDOES the lock-down (restoring inheritance, the permissive <c>%ProgramData%</c> default this exists
    /// to remove), proves it is undone, and only then saves. Passing therefore requires the SAVE to have
    /// re-applied it.</para>
    /// </summary>
    [Fact]
    public async Task SaveWebhookAsync_AlsoLocksDownTheDirectory_NotJustSetSecretAsync()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);

        // Undo the constructor's lock-down so the assertion below can only be satisfied by the save.
        var info = new DirectoryInfo(dir);
        var relaxed = info.GetAccessControl(AccessControlSections.Access);
        relaxed.SetAccessRuleProtection(isProtected: false, preserveInheritance: true);
        info.SetAccessControl(relaxed);
        Assert.False(info.GetAccessControl(AccessControlSections.Access).AreAccessRulesProtected);

        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        Assert.True(new DirectoryInfo(dir).GetAccessControl(AccessControlSections.Access).AreAccessRulesProtected,
            "SaveWebhookAsync stored a credential (the webhook URL) without re-applying the directory ACL. " +
            "Under LocalMachine-scoped DPAPI that ACL is the confidentiality boundary against another local " +
            "account, and it must be applied on every credential write — see UpsertSecretAsync.");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9. Minimum priority is a THRESHOLD, never an override.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <see cref="AlarmPriority"/> is declared most-severe-FIRST, so the comparison is
    /// inverted relative to the obvious reading. Getting it backwards would produce a channel that
    /// delivers everything except the alarms that matter.</summary>
    [Theory]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.Critical, false)]   // High does not meet a Critical-only bar
    [InlineData(AlarmPriority.Critical, AlarmPriority.High, true)]    // Critical always clears a High bar
    [InlineData(AlarmPriority.High, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.Medium, AlarmPriority.High, false)]
    public void MeetsThreshold_TreatsCriticalAsMoreSevereThanHigh(
        AlarmPriority alarm, AlarmPriority minimum, bool expected) =>
        Assert.Equal(expected, NotificationDelivery.MeetsThreshold(alarm, minimum));

    /// <summary>
    /// 🔴 The Identity cap keeps its meaning. <c>AlarmSource.Identity</c> is capped at
    /// <see cref="AlarmPriority.High"/> by deliberate design so an expiring certificate can never reach a
    /// Critical-only gate and halt production. Nothing in this store can change that: a channel's
    /// configuration decides only whether an alarm is DELIVERED, and there is no code path by which it can
    /// alter an alarm's priority.
    /// </summary>
    [Fact]
    public async Task ChannelConfiguration_CanFilterButCanNeverPromoteAnAlarmsPriority()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.Critical, "https://mes.plant/hook"));

        var webhook = await store.GetWebhookAsync();

        // A High alarm (everything Identity can ever be) does not reach a Critical-only channel...
        Assert.False(webhook.Delivers(AlarmPriority.High));
        // ...and a Critical one does. The alarm's own priority is the input, never an output.
        Assert.True(webhook.Delivers(AlarmPriority.Critical));

        // Disabled beats any threshold.
        Assert.True(await store.SaveWebhookAsync(enabled: false, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.False((await store.GetWebhookAsync()).Delivers(AlarmPriority.Critical));

        // A channel that was never configured delivers nothing rather than throwing.
        Assert.False(((SmtpChannelConfig?)null).Delivers(AlarmPriority.Critical));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task C-3 — the auth-header ladder entry (schema v2).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The escape hatch C-2 designed and left to C-3, exercised end to end: the header NAME is a plain
    /// column visible in the public read (knowing a webhook uses <c>X-Api-Key</c> authorises nobody), while
    /// the TOKEN is a DPAPI blob that the public read can only report the EXISTENCE of.
    /// </summary>
    [Fact]
    public async Task TheAuthHeaderName_IsPubliclyReadable_WhileItsTokenIsOnlyEverReportedAsPresent()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/alarm",
            label: "MES", authHeaderName: "X-Api-Key"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken, SecretSentinel));

        var summary = Assert.Single(await store.ListAsync()).Webhook!;
        Assert.Equal("X-Api-Key", summary.AuthHeaderName);
        Assert.True(summary.HasAuthToken);

        // The whole public read, serialised, still cannot carry the token.
        var serialised = JsonSerializer.Serialize(await store.ListAsync());
        Assert.DoesNotContain(SecretSentinel, serialised, StringComparison.Ordinal);

        // The engine-internal read carries the header name; the token comes only from GetSecretAsync.
        var config = await store.GetWebhookAsync();
        Assert.Equal("X-Api-Key", config!.AuthHeaderName);
        Assert.Equal(SecretSentinel, await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken));

        // And it is genuinely optional — re-saving without one clears it rather than keeping a stale name.
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/alarm"));
        Assert.Null(Assert.Single(await store.ListAsync()).Webhook!.AuthHeaderName);
    }

    /// <summary>
    /// 🔴 The header a configuration must never be allowed to name.
    ///
    /// <para><c>X-ST4I-Signature</c> is the most damaging: a webhook configuration able to set it could
    /// OVERWRITE THE SIGNATURE the channel just computed, turning an authenticated POST into one carrying
    /// an attacker-chosen value. The rest are either set by the channel or owned by the HTTP stack, and a
    /// name containing CR/LF is a request-splitting primitive. All are refused at SAVE time so the bad
    /// configuration cannot be stored and then silently ignored at send time.</para>
    /// </summary>
    [Theory]
    [InlineData("X-ST4I-Signature")]
    [InlineData("x-st4i-signature")]     // case-insensitive, as HTTP header names are
    [InlineData("X-ST4I-Timestamp")]
    [InlineData("X-ST4I-Delivery")]
    [InlineData("Content-Type")]
    [InlineData("Host")]
    [InlineData("Content-Length")]
    [InlineData("X-Bad Header")]         // space is not a token character
    [InlineData("X-Bad\r\nInjected: 1")] // request splitting
    [InlineData("")]
    public async Task SaveWebhookAsync_RefusesAnAuthHeaderNameThatIsReservedOrMalformed(string headerName)
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.False(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/alarm", authHeaderName: headerName));

        // Refused means NOT PERSISTED — including the channel row, because the whole save is one
        // transaction. A half-saved webhook with no auth header is not the failure mode either.
        Assert.Empty(await store.ListAsync());
    }

    [Theory]
    [InlineData("Authorization")]
    [InlineData("X-Api-Key")]
    [InlineData("X-Auth-Token")]
    public async Task SaveWebhookAsync_AcceptsTheHeaderNamesARealReceiverActuallyUses(string headerName)
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/alarm", authHeaderName: headerName));
        Assert.Equal(headerName, Assert.Single(await store.ListAsync()).Webhook!.AuthHeaderName);
    }

    /// <summary>
    /// 🔴 The first genuine APPEND to this migration ladder, proved against a database that was created at
    /// v1 — which is the only state the ladder exists for. C-2's v1 was reshaped in place on the grounds
    /// that no build had ever created the file; that argument does not extend to v2, and this test is what
    /// makes "appending works" a fact rather than a plan.
    ///
    /// <para>🔴 Task C-6 extended it to cover v3 (the relay's <c>on_value</c>/<c>off_value</c> append) on the
    /// SAME seeded v1 database, so what is proved is a TWO-step catch-up from v1 → v3 in one open, not two
    /// independent one-step upgrades. That is the case an install skipping a release actually hits, and it is
    /// the one an "each version was tested against its own predecessor" ladder can silently fail.</para>
    /// </summary>
    [Fact]
    public async Task TheLadder_UpgradesAnExistingV1DatabaseTwoStepsToV3_WithoutLosingItsRows()
    {
        var dir = TempDir();
        var dbPath = Path.Combine(dir, "notifications.db");

        // A v1 database, built by hand exactly as C-2 shipped it: webhook_config with NO auth_header_name.
        using (var seed = new SqliteConnection($"Data Source={dbPath}"))
        {
            seed.Open();
            foreach (var sql in new[]
            {
                "PRAGMA foreign_keys=ON;",
                """
                CREATE TABLE notification_channels (
                  channel TEXT NOT NULL, instance TEXT NOT NULL DEFAULT 'default',
                  enabled INTEGER NOT NULL, min_priority TEXT NOT NULL,
                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                  PRIMARY KEY (channel, instance));
                """,
                """
                CREATE TABLE webhook_config (
                  channel TEXT NOT NULL, instance TEXT NOT NULL DEFAULT 'default',
                  endpoint TEXT NOT NULL, url_fingerprint TEXT NOT NULL, label TEXT NULL,
                  PRIMARY KEY (channel, instance),
                  FOREIGN KEY (channel, instance)
                    REFERENCES notification_channels(channel, instance) ON DELETE CASCADE);
                """,
                """
                CREATE TABLE smtp_config (
                  channel TEXT NOT NULL, instance TEXT NOT NULL DEFAULT 'default',
                  host TEXT NOT NULL, port INTEGER NOT NULL, tls_mode TEXT NOT NULL,
                  from_address TEXT NOT NULL, recipients_json TEXT NOT NULL, username TEXT NULL,
                  PRIMARY KEY (channel, instance),
                  FOREIGN KEY (channel, instance)
                    REFERENCES notification_channels(channel, instance) ON DELETE CASCADE);
                """,
                """
                CREATE TABLE relay_config (
                  channel TEXT NOT NULL, instance TEXT NOT NULL DEFAULT 'default',
                  machine_code TEXT NOT NULL, target_kind TEXT NOT NULL, target_name TEXT NOT NULL,
                  PRIMARY KEY (channel, instance),
                  FOREIGN KEY (channel, instance)
                    REFERENCES notification_channels(channel, instance) ON DELETE CASCADE);
                """,
                """
                CREATE TABLE notification_secrets (
                  channel TEXT NOT NULL, instance TEXT NOT NULL DEFAULT 'default', name TEXT NOT NULL,
                  secret BLOB NOT NULL, updated_at TEXT NOT NULL,
                  PRIMARY KEY (channel, instance, name),
                  FOREIGN KEY (channel, instance)
                    REFERENCES notification_channels(channel, instance) ON DELETE CASCADE);
                """,
                """
                INSERT INTO notification_channels (channel, instance, enabled, min_priority, created_at, updated_at)
                VALUES ('Relay', 'default', 1, 'Critical', '2026-01-01T00:00:00.0000000+00:00',
                        '2026-01-01T00:00:00.0000000+00:00');
                """,
                """
                INSERT INTO relay_config (channel, instance, machine_code, target_kind, target_name)
                VALUES ('Relay', 'default', 'MODBUS-01', 'Command', 'AnnunciatorOn');
                """,
                "PRAGMA user_version = 1;",
            })
            {
                using var cmd = seed.CreateCommand();
                cmd.CommandText = sql;
                cmd.ExecuteNonQuery();
            }
        }
        SqliteConnection.ClearAllPools();

        // Opening the store catches up BOTH pending versions in one go.
        var store = new NotificationConfigStore(dir);
        using (var connection = Open(store))
        {
            Assert.Equal(3L, UserVersion(connection));
        }

        // The pre-existing row is untouched by either step...
        var relay = await store.GetRelayAsync();
        Assert.Equal("MODBUS-01", relay!.MachineCode);
        Assert.Equal("AnnunciatorOn", relay.TargetName);
        // ...and its v3 columns read back as NULL, which is exactly right for a Command target.
        Assert.Null(relay.OnValueJson);
        Assert.Null(relay.OffValueJson);

        // v2's column is usable, defaulting to "no auth header" for anything saved before it.
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.High, "https://mes.plant/alarm", authHeaderName: "X-Api-Key"));
        Assert.Equal("X-Api-Key", (await store.GetWebhookAsync())!.AuthHeaderName);

        // 🔴 And v3's columns are usable: the same instance can be re-saved as a POINT target carrying the
        // latch values C-2 deliberately left for C-6 to decide.
        Assert.True(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, "MODBUS-01", RelayTargetKind.Point, "annunciator",
            onValueJson: "true", offValueJson: "false"));
        var upgraded = await store.GetRelayAsync();
        Assert.Equal(RelayTargetKind.Point, upgraded!.TargetKind);
        Assert.Equal("true", upgraded.OnValueJson);
        Assert.Equal("false", upgraded.OffValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static SqliteConnection Open(NotificationConfigStore store)
    {
        var connection = new SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();
        return connection;
    }

    /// <summary>🔴 Review round 1 (I1) — the table list the structural test walks comes from the DATABASE,
    /// never from a list maintained beside it, so a table added tomorrow is covered today.</summary>
    private static List<string> DiscoverTables(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText =
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
        var tables = new List<string>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) tables.Add(reader.GetString(0));
        return tables;
    }

    /// <summary>Asserts <paramref name="needle"/> appears nowhere in the database file or its WAL/SHM
    /// sidecars. Pools are cleared first so the file is closed (and the WAL checkpointed back into it).</summary>
    private static void AssertNotOnDisk(NotificationConfigStore store, string needle)
    {
        var text = ReadAllDbBytesAsText(store);
        Assert.False(string.IsNullOrEmpty(text)); // non-vacuity: something really was read from disk
        Assert.DoesNotContain(needle, text, StringComparison.Ordinal);
    }

    private static string ReadAllDbBytesAsText(NotificationConfigStore store)
    {
        SqliteConnection.ClearAllPools();

        var combined = new System.Text.StringBuilder();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            var path = store.DbPath + suffix;
            if (!File.Exists(path)) continue;
            combined.Append(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(path)));
        }
        return combined.ToString();
    }

    private static long UserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt64(cmd.ExecuteScalar()!);
    }
}
